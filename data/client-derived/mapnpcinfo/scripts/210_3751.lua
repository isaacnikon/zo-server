90

if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><256001><0>West County Pass War\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><256001><0>West County Pass War\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><256001><0>West County Pass War\n"
end


level=macro_GetPlayerAttr(32)
offset = level - 90
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><256005><0>North County Pass War\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><256005><0>North County Pass War\n"
else								--红色
	claver = claver.."#0<0>●#2<5><256005><0>North County Pass War\n"
end


level=macro_GetPlayerAttr(32)
offset = level - 92
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><256007><0>Cheering Duo\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><256007><0>Cheering Duo\n"
else								--红色
	claver = claver.."#0<0>●#2<5><256007><0>Cheering Duo\n"
end


macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 