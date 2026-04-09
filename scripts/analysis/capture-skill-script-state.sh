#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <wine-pid-hex>" >&2
  exit 1
fi

wine_pid="$1"

winedbg --command $'attach '"$wine_pid"$'
break *0x0051f320
cont
print/x $eip
print/x $ecx
print/x *(int*)($esp+4)
print/x *(int*)($esp+8)
print/x *(int*)($esp+12)
print/x *(int*)($esp+16)
print/x *(short*)(*(int*)($esp+8)+0x12)
print/x *(int*)(*(int*)($esp+8)+0x1c)
print/x *(int*)(*(int*)($esp+8)+0x100)
x/8wx *(int*)($esp+8)+0xf0
delete 1
break *0x0051f070
cont
print/x $eip
print/x $ecx
print/x *(int*)($esp+4)
print/x *(int*)($esp+8)
print/x *(int*)($esp+12)
print/x *(int*)($esp+16)
print/x *(int*)($esp+20)
quit' 2>&1
