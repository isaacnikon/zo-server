74
if (offset>3) then						--ºÖÉ«
	claver = "#0<0>\n\n¡ñ#2<1><240002><0>Punishment\n"
elseif ((offset<3) and (offset>-3)) then 			--»ÆÉ«
	claver = "#0<0>\n\n¡ñ#2<9><240002><0>Punishment\n"
else								--ºìÉ«
	claver = "#0<0>\n\n¡ñ#2<5><240002><0>Punishment\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
claver = "#0<0>¡ñ#2<2><110000><0>£ÛHelp Map£Ý\n"