32
if (offset>3) then						--褐色
	claver = "#0<0>\n\n●#2<1><219001><0>Poisoned Rain\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = "#0<0>\n\n●#2<9><219001><0>Poisoned Rain\n"
else								--红色
	claver = "#0<0>\n\n●#2<5><219001><0>Poisoned Rain\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 34
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><219002><0>Demon Party\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><219002><0>Demon Party\n"
else								--红色
	claver = claver.."#0<0>●#2<5><219002><0>Demon Party\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 35
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><219012><0>World Disaster\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><219012><0>World Disaster\n"
else								--红色
	claver = claver.."#0<0>●#2<5><219012><0>World Disaster\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 38
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><219013><0>The Secret of the Lake\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><219013><0>The Secret of the Lake\n"
else								--红色
	claver = claver.."#0<0>●#2<5><219013><0>The Secret of the Lake\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 45
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><219007><0> The Tempest\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><219007><0> The Tempest\n"
else								--红色
	claver = claver.."#0<0>●#2<5><219007><0> The Tempest\n"
end

level=macro_GetPlayerAttr(32)
offset = level - 50
if (offset>3) then						--褐色
	claver = claver.."#0<0>●#2<1><219008><0>Secret Password\n"
elseif ((offset<3) and (offset>-3)) then 			--黄色
	claver = claver.."#0<0>●#2<9><219008><0>Secret Password\n"
else								--红色
	claver = claver.."#0<0>●#2<5><219008><0>Secret Password\n"
end

macro_GuiSetText("npcmapinfo",claver)
macro_GuiSetTextCurrentP("npcmapinfo")
level=macro_GetPlayerAttr(32)
offset = level - 