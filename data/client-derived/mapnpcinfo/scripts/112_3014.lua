16
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><204535><0>Heirloom Tracing\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><204535><0>Heirloom Tracing\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><204535><0>Heirloom Tracing\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 18
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><204537><0>Lost Badge\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><204537><0>Lost Badge\n"
else								--红色
	claver = claver.."#0<0>●#2<5><204537><0>Lost Badge\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 