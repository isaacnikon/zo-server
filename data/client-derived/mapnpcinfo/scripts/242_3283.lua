54
if (offset>3) then						--ºÖÉ«
	claver = "#0<0>\n\n¡ñ#2<1><232001><0>Adventure in Longicorn State\n"
elseif ((offset<3) and (offset>-3)) then 			--»ÆÉ«
	claver = "#0<0>\n\n¡ñ#2<9><232001><0>Adventure in Longicorn State\n"
else								--ºìÉ«
	claver = "#0<0>\n\n¡ñ#2<5><232001><0>Adventure in Longicorn State\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 