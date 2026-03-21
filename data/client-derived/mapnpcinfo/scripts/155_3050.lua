22

if (offset>3) then						--褐色
	--claver = "#0<0>\n\n●#2<1><227500><0>铜锅\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	--claver = "#0<0>\n\n●#2<9><227500><0>铜锅\n"
else								--红色
	--claver = "#0<0>\n\n●#2<5><227500><0>铜锅\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 22

if (offset>3) then						--褐色
	--claver = claver.."#0<0>●#2<1><227502><0>前世造孽\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	--claver = claver.."#0<0>●#2<9><227502><0>前世造孽\n"
else								--红色
	--claver = claver.."#0<0>●#2<5><227502><0>前世造孽\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 