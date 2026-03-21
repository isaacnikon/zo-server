13
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><208501><0>Lazy Soldier\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><208501><0>Lazy Soldier\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><208501><0>Lazy Soldier\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 16
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><208502><0>Coward\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><208502><0>Coward\n"
else								--红色
	claver = claver.."#0<0>●#2<5><208502><0>Coward\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 