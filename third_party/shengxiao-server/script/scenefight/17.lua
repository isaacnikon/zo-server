
	


	macro_AddFightMonster(5037,1,3,21,1)

i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(28002,0,2,21,2)
	macro_AddFightMonster(5037,1,2,22,3)
elseif (i==2) then        
       	macro_AddFightMonster(5038,1,1,22,2)
	macro_AddFightMonster(5037,1,2,22,3)
elseif (i==3) then
	macro_AddFightMonster(28002,0,2,22,2)
	macro_AddFightMonster(5038,1,2,22,3)
	macro_AddFightMonster(5037,1,1,21,4)
end



	

