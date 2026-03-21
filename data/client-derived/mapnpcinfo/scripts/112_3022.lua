1
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><204012><0>Study\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><204012><0>Study\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><204012><0>Study\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 11
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><204504><0>Crusade for Caterans\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><204504><0>Crusade for Caterans\n"
else								--红色
	claver = claver.."#0<0>●#2<5><204504><0>Crusade for Caterans\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 11
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><204505><0>Crusade for Bandit\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><204505><0>Crusade for Bandit\n"
else								--红色
	claver = claver.."#0<0>●#2<5><204505><0>Crusade for Bandit\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 12
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><204506><0>Cateran Leader\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><204506><0>Cateran Leader\n"
else								--红色
	claver = claver.."#0<0>●#2<5><204506><0>Cateran Leader\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 12
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><204507><0>Bandit Leader\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><204507><0>Bandit Leader\n"
else								--红色
	claver = claver.."#0<0>●#2<5><204507><0>Bandit Leader\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 16
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><204008><0>Thief Catcher\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><204008><0>Thief Catcher\n"
else								--红色
	claver = claver.."#0<0>●#2<5><204008><0>Thief Catcher\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 19
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><204010><0>Seduction\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><204010><0>Seduction\n"
else								--红色
	claver = claver.."#0<0>●#2<5><204010><0>Seduction\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 20
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><204508><0>Evil Giant Bear\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><204508><0>Evil Giant Bear\n"
else								--红色
	claver = claver.."#0<0>●#2<5><204508><0>Evil Giant Bear\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 20
if (offset>3) then						     --褐色
	claver = claver.."#0<0>●#2<1><204534><0>The Immortal in Goal Manor\n"
elseif ((offset<3) and (offset>-3)) then 			     --黄色
	claver = claver.."#0<0>●#2<9><204534><0>The Immortal in Goal Manor\n"
else								     --红色
	claver = claver.."#0<0>●#2<5><204534><0>The Immortal in Goal Manor\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")





level=macro_GetPlayerAttr(32)
offset = level - 