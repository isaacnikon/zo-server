50
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><230500><0>The Giant Petal\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><230500><0>The Giant Petal\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><230500><0>The Giant Petal\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 50
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><230504><0>The Suffering\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><230504><0>The Suffering\n"
else								--红色
	claver = claver.."#0<0>●#2<5><230504><0>The Suffering\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 