

        macro_AddFightMonster(5097,0,1,35,1)
        macro_AddFightMonster(5097,0,3,36,2)
	macro_AddFightMonster(5096,1,0,35,3)
	macro_AddFightMonster(5096,1,4,37,4)

i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(5097,0,2,37,5)
elseif (i==2) then        
       	macro_AddFightMonster(5096,1,1,36,5)
elseif (i==3) then
	macro_AddFightMonster(5097,0,2,37,5)
	macro_AddFightMonster(5096,1,1,36,6)
end



