	macro_AddFightMonster(5086,1,3,25,1)

i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(5086,0,2,25,2)
elseif (i==2) then        
       	macro_AddFightMonster(5087,1,1,23,2)
elseif (i==3) then
	macro_AddFightMonster(5086,0,2,25,2)
	macro_AddFightMonster(5087,1,1,24,3)
end



	


