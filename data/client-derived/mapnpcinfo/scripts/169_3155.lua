64
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><230009><0>Ghost Hunting\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><230009><0>Ghost Hunting\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><230009><0>Ghost Hunting\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 65
if (offset>3) then						           --褐色
	claver = claver.."#0<0>●#2<1><230010><0>Dementor's Appearance\n"
elseif ((offset<3) and (offset>-3)) then 			           --黄色
	claver = claver.."#0<0>●#2<9><230010><0>Dementor's Appearance\n"
else								           --红色
	claver = claver.."#0<0>●#2<5><230010><0>Dementor's Appearance\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 66
if (offset>3) then						--褐色
	claver = claver.."#0<0>\n\n●#2<1><230013><0>Gnome\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>\n\n●#2<9><230013><0>Gnome\n"
else								--红色
	claver = claver.."#0<0>\n\n●#2<5><230013><0>Gnome\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 