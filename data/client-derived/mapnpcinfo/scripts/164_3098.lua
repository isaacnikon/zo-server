45
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><218001><0>Neeza's Birth\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><218001><0>Neeza's Birth\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><218001><0>Neeza's Birth\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 45
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><218002><0>Mentor's Care\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><218002><0>Mentor's Care\n"
else								--红色
	claver = claver.."#0<0>●#2<5><218002><0>Mentor's Care\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 