40

if (offset>3) then						--褐色
	--claver = "#0<0>\n\n●#2<1><228500><0>密谋造反\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	--claver = "#0<0>\n\n●#2<9><228500><0>密谋造反\n"
else								--红色
	--claver = "#0<0>\n\n●#2<5><228500><0>密谋造反\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
--level=macro_GetPlayerAttr(32)
offset = level 