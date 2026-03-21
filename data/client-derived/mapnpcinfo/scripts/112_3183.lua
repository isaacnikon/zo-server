10
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><204513><0>Beggar's Secret\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><204513><0>Beggar's Secret\n"
else								--红色
	claver = claver.."#0<0>●#2<5><204513><0>Beggar's Secret\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 13
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><204515><0>First Thing for the Fairy\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><204515><0>First Thing for the Fairy\n"
else								--红色
	claver = claver.."#0<0>●#2<5><204515><0>First Thing for the Fairy\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 13
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><204516><0>Second Thing for the Fairy\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><204516><0>Second Thing for the Fairy\n"
else								--红色
	claver = claver.."#0<0>●#2<5><204516><0>Second Thing for the Fairy\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 