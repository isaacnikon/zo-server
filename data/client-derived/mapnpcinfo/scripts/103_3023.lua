1
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><202002><0>Magic Flask\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><202002><0>Magic Flask\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><202002><0>Magic Flask\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 1
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><202004><0>Hungry Wolves\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><202004><0>Hungry Wolves\n"
else								--红色
	claver = claver.."#0<0>●#2<5><202004><0>Hungry Wolves\n"
end


macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 