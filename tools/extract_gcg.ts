import fs from 'node:fs';
import zlib from 'node:zlib';

const data = fs.readFileSync('/home/nikon/Data/Zodiac Online/gcg/attrres.rc');

// Parse header
const magic = data.toString('ascii', 0, 4);
const version = data.readUInt32LE(4);
const entryCount = data.readUInt32LE(8);
console.log(`Magic: ${magic}, Version: 0x${version.toString(16)}, Entries: ${entryCount}`);

// Parse entries - need to figure out the format
// From hex dump, after the 16-byte header, entries are variable-length
// Let's try to parse them by scanning

let offset = 16; // after header

function parseEntry(off: number) {
    // Based on the hex pattern, each directory/file entry seems to have:
    // First, let's check if this looks like a size field or something else
    // Looking at the pattern more carefully:
    //
    // For "attrres" (directory marker):
    //   81 73 00 00 = 0x7381
    //   7d 73 00 00 = 0x737d
    //   00 08 00 35 = ???
    //   00 = null terminator after "attrres"
    //   But wait, the name comes after these fields
    //
    // Let me re-read the hex more carefully:
    // offset 0x10: 81 73 00 00  7d 73 00 00  00 08 00 35  00 61 74 74
    //              ^^^^^^^^^^^  ^^^^^^^^^^^  ^^^^^^^^^^^  ^^ ^^^^^^^^
    //              field1       field2       field3       \0? name...
    //
    // Actually looking at offset 0x1c: "00" then "attrres\0"
    // That 00 might be part of field3 or a separate byte
    //
    // Let me look at the structure differently. The "35 00" before name could be:
    // 0x35 = 53 = length of something?
    //
    // Actually re-examining: 00 08 00 35 could be two u16: 0x0800 and 0x3500
    // Or it could be flags bytes

    // Let me try a different approach - just find all filenames and their preceding data
    return null;
}

// Let's just find all entries by scanning for patterns
// Each entry seems to start with some size fields, then a null-terminated name
// Let me look at the structure around roleinfo.txt

// roleinfo.txt is at offset 0x136e
// Preceding bytes from hex dump:
// 001360: 0d 00 30 90 09 00 f7 d1 07 00 12 cc 02 00 72 6f
//                ^^^^^^^^^^^  ^^^^^^^^^^^  ^^^^^^^^^^^  ^^^^^
//                offset?      comp_size?   decomp_size? "ro"
// 001370: 6c 65 69 6e 66 6f 2e 74 78 74 00
//         "leinfo.txt\0"

// So before the name we have three u32 LE values:
// 0x099030 = compressed data offset
// 0x07d1f7 = compressed size
// 0x02cc12 = decompressed size

// But wait - let me check the pattern with areainfo.txt at offset 0x38
// Bytes: 91 73 00 00  6f 0a 00 00  64 07 00 00  "areainfo.txt\0"
// offset=0x7391, comp_size=0x0a6f, decomp_size=0x0764

// And there are some bytes between the name and the next entry's fields
// After "areainfo.txt\0": 23 00 00 00 01 10 00
// After "attrres\0":      20 00 00 00 01 0d 00

// So it seems like after each name there's a variable-length metadata section
// Let me try to figure out the directory structure

// Actually, let me re-read more carefully. The first entry "attrres" at offset 0x10:
// 81 73 00 00 = u32 total_size or offset = 0x7381
// 7d 73 00 00 = u32 = 0x737d
// 00 08 00 35 = could be different format for directory
// 00 = ?
// "attrres\0"
// 20 00 00 00 = u32 = 0x20 = 32
// 01 = ?
// 0d 00 = ?

// Let me try another approach: directories have a different structure
// "attrres" has no .txt extension - it's a directory
// The "20 00 00 00" after it might be the total size of entries within
// "01" might be entry count or type
// "0d 00" might be number of child entries (13 = 0x0d)

// For areainfo.txt right after:
// 91 73 00 00 = offset in file = 0x7391
// 6f 0a 00 00 = compressed size = 0x0a6f
// 64 07 00 00 = decompressed size = 0x0764
// "areainfo.txt\0"
// 23 00 00 00 = next entry size?
// 01 10 00 = ?

// I think the format might be:
// For each directory: some header, then name, then child count info
// For each file: u32 offset, u32 comp_size, u32 decomp_size, name\0

// Let me just scan for "roleinfo.txt" and extract the 12 bytes before it

const roleInfoNameOffset = data.indexOf('roleinfo.txt\0');
console.log(`\nroleinfo.txt name at offset: 0x${roleInfoNameOffset.toString(16)}`);

// Read the 12 bytes (3 x u32) before the name
const fileOffset = data.readUInt32LE(roleInfoNameOffset - 12);
const compSize = data.readUInt32LE(roleInfoNameOffset - 8);
const decompSize = data.readUInt32LE(roleInfoNameOffset - 4);
console.log(`File offset: 0x${fileOffset.toString(16)} (${fileOffset})`);
console.log(`Compressed size: 0x${compSize.toString(16)} (${compSize})`);
console.log(`Decompressed size: 0x${decompSize.toString(16)} (${decompSize})`);

// But wait - there might be metadata bytes between entries too
// Let me also check what comes BEFORE those 12 bytes
const prevBytes = [];
for (let i = roleInfoNameOffset - 20; i < roleInfoNameOffset; i++) {
    prevBytes.push(data[i].toString(16).padStart(2, '0'));
}
console.log(`\n20 bytes before name: ${prevBytes.join(' ')}`);

// From the hex dump at 0x1360:
// 0d 00 | 30 90 09 00 | f7 d1 07 00 | 12 cc 02 00 | roleinfo.txt\0
// The "0d 00" is the tail of the previous entry's metadata

// So the three u32 LE values before the name are:
// offset in archive = 0x099030
// compressed size   = 0x07d1f7 = 512503
// decompressed size = 0x02cc12 = 183314

console.log(`\nArchive file size: ${data.length}`);
console.log(`Data range: 0x${fileOffset.toString(16)} to 0x${(fileOffset + compSize).toString(16)}`);

if (fileOffset + compSize <= data.length) {
    const compressedData = data.slice(fileOffset, fileOffset + compSize);
    console.log(`\nFirst 16 bytes of compressed data: ${Array.from(Buffer.from(compressedData.slice(0, 16))).map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);

    // Try zlib decompress
    try {
        const result = zlib.inflateSync(compressedData);
        console.log(`\nZlib decompressed OK! Size: ${result.length}`);
        fs.writeFileSync('/home/nikon/projects/zo-server/roleinfo.txt', result);
        console.log('Saved to roleinfo.txt');
        console.log('\nFirst 500 chars:');
        console.log(result.toString('utf8', 0, 500));
    } catch (e: any) {
        console.log(`Zlib failed: ${e.message}`);

        // Try raw deflate
        try {
            const result = zlib.inflateRawSync(compressedData);
            console.log(`\nRaw deflate decompressed OK! Size: ${result.length}`);
            fs.writeFileSync('/home/nikon/projects/zo-server/roleinfo.txt', result);
            console.log('Saved to roleinfo.txt');
            console.log('\nFirst 500 chars:');
            console.log(result.toString('utf8', 0, 500));
        } catch (e2: any) {
            console.log(`Raw deflate failed: ${e2.message}`);

            // Maybe it's not compressed, just stored
            if (compSize === decompSize) {
                console.log('\nSizes match - data is stored uncompressed');
                fs.writeFileSync('/home/nikon/projects/zo-server/roleinfo.txt', compressedData);
            } else {
                // Try gunzip
                try {
                    const result = zlib.gunzipSync(compressedData);
                    console.log(`\nGunzip decompressed OK! Size: ${result.length}`);
                    fs.writeFileSync('/home/nikon/projects/zo-server/roleinfo.txt', result);
                } catch(e3: any) {
                    console.log(`Gunzip failed: ${e3.message}`);
                    console.log('\nTrying with offset adjustments...');

                    // Sometimes archives have a small header before compressed data
                    for (let skip = 1; skip <= 8; skip++) {
                        try {
                            const result = zlib.inflateSync(compressedData.slice(skip));
                            console.log(`Zlib with skip=${skip} worked! Size: ${result.length}`);
                            fs.writeFileSync('/home/nikon/projects/zo-server/roleinfo.txt', result);
                            console.log('\nFirst 500 chars:');
                            console.log(result.toString('utf8', 0, 500));
                            break;
                        } catch(_e4) {}
                        try {
                            const result = zlib.inflateRawSync(compressedData.slice(skip));
                            console.log(`Raw deflate with skip=${skip} worked! Size: ${result.length}`);
                            fs.writeFileSync('/home/nikon/projects/zo-server/roleinfo.txt', result);
                            console.log('\nFirst 500 chars:');
                            console.log(result.toString('utf8', 0, 500));
                            break;
                        } catch(_e5) {}
                    }
                }
            }
        }
    }
} else {
    console.log('ERROR: offset + size exceeds file size!');
    console.log('The offset interpretation might be wrong.');

    // Maybe the fields are in different order or different sizes
    // Let me try reading as: u32 decomp_size, u32 comp_size, u32 offset
    const alt_decomp = data.readUInt32LE(roleInfoNameOffset - 12);
    const alt_comp = data.readUInt32LE(roleInfoNameOffset - 8);
    const alt_offset = data.readUInt32LE(roleInfoNameOffset - 4);
    console.log(`\nAlt interpretation: offset=0x${alt_offset.toString(16)}, comp=0x${alt_comp.toString(16)}, decomp=0x${alt_decomp.toString(16)}`);
}
