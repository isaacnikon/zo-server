
	


	macro_AddFightMonster(5051,1,3,18,1)

i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(5051,0,2,17,2)
	macro_AddFightMonster(5050,1,2,16,3)
elseif (i==2) then        
       	macro_AddFightMonster(5050,1,1,18,2)
	macro_AddFightMonster(5050,1,2,15,3)
elseif (i==3) then
	macro_AddFightMonster(5051,0,2,18,2)
	macro_AddFightMonster(5050,1,2,16,3)
	macro_AddFightMonster(5050,1,1,15,4)
end





	