1
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><204019><0>Disenchanting\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><204019><0>Disenchanting\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><204019><0>Disenchanting\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 1
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><204020><0>Magical Adventure\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><204020><0>Magical Adventure\n"
else								--红色
	claver = claver.."#0<0>●#2<5><204020><0>Magical Adventure\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 