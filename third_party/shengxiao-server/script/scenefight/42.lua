

        macro_AddFightMonster(5034,0,1,22,1)
        macro_AddFightMonster(5034,0,3,21,2)
	macro_AddFightMonster(5034,1,0,20,3)
	macro_AddFightMonster(5034,1,4,22,4)

i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(5038,0,2,20,5)
elseif (i==2) then        
       	macro_AddFightMonster(5034,1,1,22,5)
elseif (i==3) then
	macro_AddFightMonster(5038,0,2,21,5)
	macro_AddFightMonster(5034,1,1,22,6)
end



