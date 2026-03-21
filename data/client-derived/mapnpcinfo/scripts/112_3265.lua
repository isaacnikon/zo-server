11
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><204532><0>The Piggy's Comeback\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><204532><0>The Piggy's Comeback\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><204532><0>The Piggy's Comeback\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 11
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><204533><0>Piggy Leader\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><204533><0>Piggy Leader\n"
else								--红色
	claver = claver.."#0<0>●#2<5><204533><0>Piggy Leader\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 