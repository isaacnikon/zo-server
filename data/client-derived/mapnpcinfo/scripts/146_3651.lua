16
if (offset>3) then						--褐色
	claver = "#0<0>●#2<1><205007><0>Another Possibility\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>●#2<9><205007><0>Another Possibility\n"
else								--红色
	claver = "#0<0>●#2<5><205007><0>Another Possibility\n"
end


level=macro_GetPlayerAttr(32)
offset = level - 24
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><205008><0>Zodiac Power\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><205008><0>Zodiac Power\n"
else								--红色
	claver = claver.."#0<0>●#2<5><205008><0>Zodiac Power\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 