50
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><230004><0>De-evil Tower\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><230004><0>De-evil Tower\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><230004><0>De-evil Tower\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 50
if (offset>3) then						      --褐色
	claver = claver.."#0<0>●#2<1><230015><0>State of Longicorn\n"
elseif ((offset<3) and (offset>-3)) then 			      --黄色
	claver = claver.."#0<0>●#2<9><230015><0>State of Longicorn\n"
else								      --红色
	claver = claver.."#0<0>●#2<5><230015><0>State of Longicorn\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 