	


	macro_AddFightMonster(5050,1,3,17,1)

i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(28006,0,2,17,2)
	macro_AddFightMonster(5051,1,2,16,3)
elseif (i==2) then        
       	macro_AddFightMonster(5051,1,1,16,2)
	macro_AddFightMonster(5050,1,2,17,3)
elseif (i==3) then
	macro_AddFightMonster(28006,0,2,16,2)
	macro_AddFightMonster(5050,1,2,15,3)
	macro_AddFightMonster(5051,1,1,17,4)
end




