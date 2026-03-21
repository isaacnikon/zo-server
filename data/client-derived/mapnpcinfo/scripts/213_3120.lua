22
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><210001><0>The Forbidden Hell\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><210001><0>The Forbidden Hell\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><210001><0>The Forbidden Hell\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 68
if (offset>3) then						--褐色
	claver = claver.."#0<0>\n\n●#2<1><210007><0>Farewell to Jessica\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>\n\n●#2<9><210007><0>Farewell to Jessica\n"
else								--红色
	claver = claver.."#0<0>\n\n●#2<5><210007><0>Farewell to Jessica\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 68
if (offset>3) then						--褐色
	claver = claver.."#0<0>\n\n●#2<1><210006><0>Flaming Hell\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>\n\n●#2<9><210006><0>Flaming Hell\n"
else								--红色
	claver = claver.."#0<0>\n\n●#2<5><210006><0>Flaming Hell\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 