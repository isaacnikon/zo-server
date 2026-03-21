62
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><230007><0>Haunted House\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><230007><0>Haunted House\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><230007><0>Haunted House\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 70
if (offset>3) then						   --褐色
	claver = claver.."#0<0>\n\n●#2<1><230014><0>Farewell to Jessica\n"
elseif ((offset<3) and (offset>-3)) then 			   --黄色
	claver = claver.."#0<0>\n\n●#2<9><230014><0>Farewell to Jessica\n"
else								   --红色
	claver = claver.."#0<0>\n\n●#2<5><230014><0>Farewell to Jessica\n"
end
macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 