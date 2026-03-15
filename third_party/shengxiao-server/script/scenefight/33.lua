	


	macro_AddFightMonster(5087,1,3,24,1)

i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(28020,0,2,24,2)
	macro_AddFightMonster(5086,1,2,25,3)
elseif (i==2) then        
       	macro_AddFightMonster(5086,1,1,23,2)
	macro_AddFightMonster(5038,1,2,25,3)
elseif (i==3) then
	macro_AddFightMonster(28020,0,2,25,2)
	macro_AddFightMonster(5038,1,2,24,3)
	macro_AddFightMonster(5086,1,1,25,4)
end




