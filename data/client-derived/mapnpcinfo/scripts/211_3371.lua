64
if (offset>3) then						--ºÖÉ«
	claver = "#0<0>\n\n¡ñ#2<1><233501><0>Flaming Tree\n"
elseif ((offset<3) and (offset>-3)) then 			--»ÆÉ«
	claver = "#0<0>\n\n¡ñ#2<9><233501><0>Flaming Tree\n"
else								--ºìÉ«
	claver = "#0<0>\n\n¡ñ#2<5><233501><0>Flaming Tree\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 