30
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><204001><0>Jeff the Door God\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><204001><0>Jeff the Door God\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><204001><0>Jeff the Door God\n"
end


level=macro_GetPlayerAttr(32)
offset = level - 35
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><204002><0>The Birth of Chaos Ghost\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><204002><0>The Birth of Chaos Ghost\n"
else								--红色
	claver = claver.."#0<0>●#2<5><204002><0>The Birth of Chaos Ghost\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 40
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><204003><0>Lonely Ghost King\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><204003><0>Lonely Ghost King\n"
else								--红色
	claver = claver.."#0<0>●#2<5><204003><0>Lonely Ghost King\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 