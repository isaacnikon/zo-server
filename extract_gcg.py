#!/usr/bin/env python3
"""Extract files from GCG .rc archives (GLoadRec format with 12-bit LZW compression)."""

import struct
import sys


def lzw_decompress_gcg(compressed_data, expected_size):
    """
    12-bit LZW decompression matching GLzwDecompress from ResManage.dll.

    Code packing (nibble-interleaved, 12 bits per code):
      Byte pair (b0, b1): code = (b0 << 4) | (b1 >> 4), leftover = b1 & 0x0F
      Next byte (b2):     code = (leftover << 8) | b2

    Special codes:
      0x100 = Clear (reset dictionary)
      0x101 = EOF
      First user code = 0x102
      Max code = 0x0FFF (12 bits)

    Dictionary: each entry has (parent_code: u16, char: u8).
    To decode an entry, walk parent chain collecting chars in reverse.
    """

    CLEAR_CODE = 0x100
    EOF_CODE = 0x101
    FIRST_CODE = 0x102
    MAX_CODE = 0x0FFF  # 12-bit

    data = compressed_data
    pos = 0
    half = False  # False = read 2 bytes for code, True = read 1 byte using leftover
    leftover = 0

    def get_code():
        nonlocal pos, half, leftover
        if not half:
            if pos + 1 >= len(data):
                return None
            b0 = data[pos]
            b1 = data[pos + 1]
            pos += 2
            code = (b0 << 4) | (b1 >> 4)
            leftover = b1 & 0x0F
            half = True
            return code
        else:
            if pos >= len(data):
                return None
            b2 = data[pos]
            pos += 1
            code = (leftover << 8) | b2
            half = False
            return code

    # Dictionary: list of (parent_code, char_byte)
    # Entries 0-255 are single-byte literals
    # parent_code = 0xFFFF means "no parent" (root entry)
    dict_parent = [0xFFFF] * (MAX_CODE + 1)
    dict_char = [0] * (MAX_CODE + 1)
    for i in range(256):
        dict_char[i] = i

    next_code = FIRST_CODE
    output = bytearray()

    def decode_string(code):
        """Walk dictionary chain, return decoded bytes."""
        chars = []
        while code >= 0x100:
            if code >= next_code:
                return None
            chars.append(dict_char[code])
            code = dict_parent[code]
        chars.append(code)  # code < 256, it's a literal
        chars.reverse()
        return bytes(chars)

    prev_code = -1  # -1 = no previous

    while len(output) < expected_size:
        code = get_code()
        if code is None:
            break

        if code > MAX_CODE:
            break

        if code == EOF_CODE:
            break

        if code == CLEAR_CODE:
            # Reset dictionary
            next_code = FIRST_CODE
            prev_code = -1
            continue

        if prev_code == -1:
            # First code after clear or start
            if code >= 256:
                break  # Invalid - first code must be literal
            output.append(code)
            prev_code = code
            continue

        if code < next_code:
            # Code exists in dictionary
            decoded = decode_string(code)
            if decoded is None:
                break
            output.extend(decoded)

            # Add new dictionary entry: prev_string + first char of current string
            if next_code <= MAX_CODE:
                dict_parent[next_code] = prev_code if prev_code >= 256 else 0xFFFF
                if prev_code < 256:
                    # Previous was a single literal
                    dict_parent[next_code] = 0xFFFF
                    # Actually, the new entry's parent is the previous code's chain
                    # and its char is the first char of the current decoded string
                    pass

                # Rethinking: in the assembly, the dict entry stores:
                #   WORD at [esi+code*4+4] = prev_code (the "old" code)
                #   BYTE at [esi+code*4+6] = first char of decoded string for prev_code's chain at position [+0x5004]
                # Actually from the asm:
                #   mov WORD PTR [esi+eax*4+0x4], bx    ; bx = prev_code (was 0xFFFF initially)
                #   mov dl, BYTE PTR [ecx+esi*1+0x4004]  ; ecx = +0x5004 value
                #   mov BYTE PTR [esi+eax*4+0x6], dl
                # Where +0x4004 is a decode buffer and +0x5004 tracks position in that buffer

                # Let me re-implement this more faithfully to the assembly
                pass

            prev_code = code
        elif code == next_code:
            # Special case: code not yet in dictionary
            # Decode prev_code, append its first char
            decoded = decode_string(prev_code)
            if decoded is None:
                break
            decoded = decoded + decoded[0:1]
            output.extend(decoded)

            if next_code <= MAX_CODE:
                pass

            prev_code = code
        else:
            break

    return bytes(output[:expected_size])


def lzw_decompress_faithful(compressed_data, expected_size):
    """
    Faithful reimplementation of GLzwDecompress::Decompress from ResManage.dll.

    Memory layout of the LZW object (this = esi):
      this+0x0004 .. this+0x3FFF: dictionary entries, 4 bytes each
        Entry[code] at this + code*4 + 4:
          +0 (u16): parent code
          +2 (u8):  character byte
      this+0x4004 .. this+0x4FFF: decode stack buffer
      this+0x5004 (u32): decode stack position (-1 = empty)
      this+0x5008 (u32): leftover nibble for GetCode
      this+0x500c (u32): GetCode phase toggle (0 or 1)
    """

    CLEAR_CODE = 0x100
    EOF_CODE = 0x101
    FIRST_CODE = 0x102
    MAX_CODE = 0x0FFF

    data = compressed_data
    byte_pos = 0
    code_phase = 0  # 0 = read 2 bytes, 1 = read 1 byte with leftover
    leftover_nibble = 0

    def get_byte():
        nonlocal byte_pos
        if byte_pos >= len(data):
            return None
        b = data[byte_pos]
        byte_pos += 1
        return b

    def get_code():
        nonlocal code_phase, leftover_nibble
        if code_phase != 0:
            # Phase 1: use leftover high nibble + next byte
            b = get_byte()
            if b is None:
                return None
            code = (leftover_nibble << 8) | b
            code_phase = 0
            return code
        else:
            # Phase 0: read 2 bytes
            b0 = get_byte()
            if b0 is None:
                return None
            b1 = get_byte()
            if b1 is None:
                return None
            code = (b0 << 4) | (b1 >> 4)
            leftover_nibble = b1 & 0x0F
            code_phase = 1
            return code

    # Dictionary: parent code (u16) and character (u8) per entry
    parent = [0] * (MAX_CODE + 1)
    char = [0] * (MAX_CODE + 1)

    # Decode stack
    decode_stack = bytearray(0x1000)

    output = bytearray()
    next_code = FIRST_CODE
    prev_code = 0xFFFFFFFF  # -1 as unsigned
    old_code = 0xFFFF  # ebx, initialized to 0xFFFF

    def output_string(code):
        """Decode a code by walking parent chain, output bytes in correct order."""
        nonlocal prev_code
        stack_pos = -1  # starts at -1, like +0x5004

        # Walk chain for codes >= 256
        c = code & 0xFFFF
        while c >= 0x100:
            stack_pos += 1
            decode_stack[stack_pos] = char[c]
            c = parent[c]
        # c is now < 256, a literal byte
        stack_pos += 1
        decode_stack[stack_pos] = c & 0xFF

        # Save the stack position
        prev_code = stack_pos

        # Output bytes from stack in reverse (top to bottom)
        ok = True
        while stack_pos >= 0:
            output.append(decode_stack[stack_pos])
            stack_pos -= 1
            if len(output) >= expected_size:
                return True

        return ok

    # Main decompression loop
    # Read first code
    code = get_code()
    if code is None or code >= 0x1000 or code == EOF_CODE:
        return bytes(output)

    if code == CLEAR_CODE:
        next_code = FIRST_CODE
        prev_code = 0xFFFFFFFF
        code = get_code()
        if code is None or code == EOF_CODE:
            return bytes(output)

    if prev_code == 0xFFFFFFFF:
        # First code - must be literal
        decode_stack[0] = code & 0xFF
        prev_code = 0
        output.append(code & 0xFF)
        old_code = code
    else:
        pass  # shouldn't happen

    while len(output) < expected_size:
        code = get_code()
        if code is None:
            break
        if code >= 0x1000:
            break
        if code == EOF_CODE:
            break

        if code == CLEAR_CODE:
            next_code = FIRST_CODE
            prev_code = 0xFFFFFFFF
            # Read next code
            code = get_code()
            if code is None or code == EOF_CODE:
                break
            if code >= 0x1000:
                break
            if prev_code == 0xFFFFFFFF:
                decode_stack[0] = code & 0xFF
                prev_code = 0
                output.append(code & 0xFF)
                old_code = code
            continue

        if code < next_code:
            # Code is in dictionary
            # Decode and output it
            output_string(code)

            # Add new entry: parent=old_code, char=first char of decoded prev string
            if next_code <= MAX_CODE:
                nc = next_code
                parent[nc] = old_code
                # The first char of the old code's decode is at decode_stack[prev_code]
                # after output_string, prev_code = stack position of the topmost
                # Actually from asm: char = decode_stack[prev_code] where prev_code was
                # set by output_string for the CURRENT code, and the "first char" of
                # the current decoded string is at the top of the stack
                # Wait - in the asm, the char used is from decode_stack at the OLD
                # prev_code position... Let me re-read.

                # ASM at 0x10002264-0x1000227b:
                # eax = next_code (edi before inc)
                # edi++ (next_code incremented)
                # WORD [esi+eax*4+4] = bx (old_code/prev code from last iteration)
                # ecx = [esi+0x5004] (stack_pos from output_string that just ran)
                # dl = BYTE [ecx + esi + 0x4004] (decode_stack[stack_pos])
                # BYTE [esi+eax*4+6] = dl

                # So after output_string(code), the stack_pos points to the FIRST
                # char of the decoded string (because it's reversed on the stack).
                # The char for the new dict entry is the first char of the CURRENT string.

                char[nc] = decode_stack[prev_code]
                next_code += 1

            old_code = code

        elif code == next_code:
            # Special case: code not in dictionary yet
            # Add new entry first, then decode
            if next_code <= MAX_CODE:
                nc = next_code
                parent[nc] = old_code
                # char = first char of old string = decode_stack[old prev_code]
                char[nc] = decode_stack[prev_code]
                next_code += 1

            # Now decode the newly added code
            output_string(code)
            old_code = code

        else:
            # Code > next_code: error
            break

    return bytes(output[:expected_size])


def find_file_entry(data, name):
    """Find a file entry in the GCRC directory."""
    needle = name.encode('ascii') + b'\x00'
    idx = data.find(needle)
    if idx < 0:
        return None
    offset = struct.unpack_from('<I', data, idx - 12)[0]
    field2 = struct.unpack_from('<I', data, idx - 8)[0]
    field3 = struct.unpack_from('<I', data, idx - 4)[0]
    # field2 = decompressed size, field3 = stored (compressed) size
    return offset, field2, field3


def main():
    filepath = '/home/nikon/Data/Zodiac Online/gcg/attrres.rc'
    data = open(filepath, 'rb').read()

    magic = data[0:4]
    print(f"Magic: {magic}")

    # Test with small file first
    for fname in ['areainfo.txt', 'roleinfo.txt']:
        entry = find_file_entry(data, fname)
        if not entry:
            print(f"\n{fname}: NOT FOUND")
            continue

        offset, decomp_size, stored_size = entry
        print(f"\n{fname}:")
        print(f"  Offset: 0x{offset:x}")
        print(f"  Decompressed size: {decomp_size}")
        print(f"  Stored size: {stored_size}")

        raw = data[offset:offset + stored_size]
        print(f"  First 24 bytes: {' '.join(f'{b:02x}' for b in raw[:24])}")

        result = lzw_decompress_faithful(raw, decomp_size)
        if result and len(result) > 0:
            text_count = sum(1 for b in result[:200] if 32 <= b < 127 or b in (9, 10, 13))
            print(f"  Decompressed: {len(result)} bytes, text ratio: {text_count}/200")
            if text_count > 100:
                print(f"  First 500 chars:")
                print(result[:500].decode('utf-8', errors='replace'))
                if fname == 'roleinfo.txt':
                    with open('/home/nikon/projects/zo-server/roleinfo.txt', 'wb') as f:
                        f.write(result)
                    print(f"\n  Saved to roleinfo.txt")
            else:
                print(f"  First 100 bytes (hex): {' '.join(f'{b:02x}' for b in result[:100])}")
                print(f"  As text: {result[:200].decode('utf-8', errors='replace')}")
        else:
            print(f"  Decompression failed (got {len(result) if result else 0} bytes)")


if __name__ == '__main__':
    main()
