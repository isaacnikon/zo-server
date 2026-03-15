	


	macro_AddFightMonster(5090,1,3,28,1)

i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(28017,0,2,29,2)
	macro_AddFightMonster(5091,1,2,30,3)
elseif (i==2) then        
       	macro_AddFightMonster(5091,1,1,29,2)
	macro_AddFightMonster(5090,1,2,30,3)
elseif (i==3) then
	macro_AddFightMonster(28017,0,2,29,2)
	macro_AddFightMonster(5090,1,2,28,3)
	macro_AddFightMonster(5091,1,1,30,4)
end





