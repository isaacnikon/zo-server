17
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><213002><0>Crane Pass Victory\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><213002><0>Crane Pass Victory\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><213002><0>Crane Pass Victory\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 19
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><213003><0>Everybodie's Wish\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><213003><0>Everybodie's Wish\n"
else								--红色
	claver = claver.."#0<0>●#2<5><213003><0>Everybodie's Wish\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 