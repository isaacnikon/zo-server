14
if (offset>3) then						--ºÖÉ«
	claver = "#0<0>\n\n¡ñ#2<1><211502><0>Íµ×¯¼ÚµÄÄ¾ÊÞ\n"
elseif ((offset<3) and (offset>-3)) then 			--»ÆÉ«
	claver = "#0<0>\n\n¡ñ#2<9><211502><0>Íµ×¯¼ÚµÄÄ¾ÊÞ\n"
else								--ºìÉ«
	claver = "#0<0>\n\n¡ñ#2<5><211502><0>Íµ×¯¼ÚµÄÄ¾ÊÞ\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 