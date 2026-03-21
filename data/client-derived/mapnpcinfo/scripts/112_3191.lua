13
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><204522><0>Mother's Illness\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><204522><0>Mother's Illness\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><204522><0>Mother's Illness\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 14
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><204523><0>Pork Soup\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><204523><0>Pork Soup\n"
else								--红色
	claver = claver.."#0<0>●#2<5><204523><0>Pork Soup\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 14
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><204528><0>Recovery\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><204528><0>Recovery\n"
else								--红色
	claver = claver.."#0<0>●#2<5><204528><0>Recovery\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 