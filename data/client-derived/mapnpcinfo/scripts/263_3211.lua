24

if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><227002><0>狭路相逢\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><227002><0>狭路相逢\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><227002><0>狭路相逢\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
macro_SetNpcIdByType(3112)
if(macro_GetSex()==1