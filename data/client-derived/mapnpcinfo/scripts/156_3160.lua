24

if (offset>3) then						--ºÖÉ«
	claver = "#0<0>\n\n¡ñ#2<1><227001><0>Flaming Hell\n"
elseif ((offset<3) and (offset>-3)) then 			--»ÆÉ«
	claver = "#0<0>\n\n¡ñ#2<9><227001><0>Flaming Hell\n"
else								--ºìÉ«
	claver = "#0<0>\n\n¡ñ#2<5><227001><0>Flaming Hell\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 