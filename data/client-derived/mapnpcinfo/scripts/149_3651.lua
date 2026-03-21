22
if (offset>3) then						--褐色
	claver = "#0<0>●#2<1><205002><0>The Fog\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>●#2<9><205002><0>The Fog\n"
else								--红色
	claver = "#0<0>●#2<5><205002><0>妖雾弥The Fog漫\n"
end


level=macro_GetPlayerAttr(32)
offset = level - 28
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><205003><0>Giant Willow\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><205003><0>Giant Willow\n"
else								--红色
	claver = claver.."#0<0>●#2<5><205003><0>Giant Willow\n"
end


level=macro_GetPlayerAttr(32)
offset = level - 28
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><205004><0>Giant Peach\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><205004><0>Giant Peach\n"
else								--红色
	claver = claver.."#0<0>●#2<5><205004><0>Giant Peach\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 28
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><205005><0>Perfection\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><205005><0>Perfection\n"
else								--红色
	claver = claver.."#0<0>●#2<5><205005><0>Perfection\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 