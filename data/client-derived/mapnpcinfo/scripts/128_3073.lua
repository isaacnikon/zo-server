16
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><208503><0>Escort\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><208503><0>Escort\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><208503><0>Escort\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 18
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><206500><0>Prodigal Son\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><206500><0>Prodigal Son\n"
else								--红色
	claver = claver.."#0<0>●#2<5><206500><0>Prodigal Son\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")level=macro_GetPlayerAttr(32)
offset = level - 