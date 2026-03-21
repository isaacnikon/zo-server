20
if (offset>3) then						--褐色
	claver = "#0<0>●#2<1><211004><0>Evil Spider\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>●#2<9><211004><0>Evil Spider\n"
else								--红色
	claver = "#0<0>●#2<5><211004><0>Evil Spider\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 20
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><211005><0>Bad News\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><211005><0>Bad News\n"
else								--红色
	claver = claver.."#0<0>●#2<5><211005><0>Bad News\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")

level=macro_GetPlayerAttr(32)
offset = level - 