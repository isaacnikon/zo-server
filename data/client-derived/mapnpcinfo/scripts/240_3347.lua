52
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><236500><0>Evil Dragon\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><236500><0>Evil Dragon\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><236500><0>Evil Dragon\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 52
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><236502><0>Blood Is Thicker than Water\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><236502><0>Blood Is Thicker than Water\n"
else								--红色
	claver = claver.."#0<0>●#2<5><236502><0>Blood Is Thicker than Water\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 