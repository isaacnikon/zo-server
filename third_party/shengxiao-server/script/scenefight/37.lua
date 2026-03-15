

        macro_AddFightMonster(5096,0,1,39,1)
        macro_AddFightMonster(5097,0,3,37,2)
	macro_AddFightMonster(5096,1,0,38,3)
	macro_AddFightMonster(5097,1,4,37,4)

i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(28027,0,2,38,5)
elseif (i==2) then        
       	macro_AddFightMonster(5096,1,1,38,5)
elseif (i==3) then
	macro_AddFightMonster(28027,0,2,37,5)
	macro_AddFightMonster(5097,1,1,39,6)
end





