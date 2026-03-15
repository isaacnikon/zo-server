

        macro_AddFightMonster(5142,0,1,46,1)
        macro_AddFightMonster(5142,0,3,45,2)
	macro_AddFightMonster(5142,1,0,46,3)
	macro_AddFightMonster(5142,1,4,47,4)
        macro_AddFightMonster(5142,1,3,46,5)
	macro_AddFightMonster(5142,1,2,45,6)

i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(5142,0,2,47,7)
elseif (i==2) then        
       	macro_AddFightMonster(5142,1,1,45,7)
elseif (i==3) then
	macro_AddFightMonster(5142,0,2,47,7)
	macro_AddFightMonster(5142,1,1,46,8)
end






