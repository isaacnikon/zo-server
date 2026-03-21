15
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><204007><0>Disenchanting\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><204007><0>Disenchanting\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><204007><0>Disenchanting\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 15
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><222001><0>Magical Adventure\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><222001><0>Magical Adventure\n"
else								--红色
	claver = claver.."#0<0>●#2<5><222001><0>Magical Adventure\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 15
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><222003><0>The Comeback\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><222003><0>The Comeback\n"
else								--红色
	claver = claver.."#0<0>●#2<5><222003><0>The Comeback\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 