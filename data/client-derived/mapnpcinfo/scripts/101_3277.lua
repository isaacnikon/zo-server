1
if (offset>3) then						--ºÖÉ«
	claver = "#0<0>\n\n¡ñ#2<1><201003><0>Watter Mill House\n"
elseif ((offset<3) and (offset>-3)) then 			--»ÆÉ«
	claver = "#0<0>\n\n¡ñ#2<9><201003><0>Watter Mill House\n"
else								--ºìÉ«
	claver = "#0<0>\n\n¡ñ#2<5><201003><0>Watter Mill House\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 