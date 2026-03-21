30
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><204004><0>Kavin the Door God\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><204004><0>Kavin the Door God\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><204004><0>Kavin the Door God\n"
end


level=macro_GetPlayerAttr(32)
offset = level - 35
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><204005><0>Lingering Fantom\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><204005><0>Lingering Fantom\n"
else								--红色
	claver = claver.."#0<0>●#2<5><204005><0>Lingering Fantom\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 40
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><204006><0>Wild Ghost King\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><204006><0>Wild Ghost King\n"
else								--红色
	claver = claver.."#0<0>●#2<5><204006><0>Wild Ghost King\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 