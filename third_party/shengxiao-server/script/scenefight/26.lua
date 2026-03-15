	


	macro_AddFightMonster(5038,1,0,22,1)

i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(28011,0,2,22,2)
	macro_AddFightMonster(5037,1,4,22,3)
elseif (i==2) then        
       	macro_AddFightMonster(5038,0,2,22,2)
	macro_AddFightMonster(5037,1,4,22,3)
elseif (i==3) then
	macro_AddFightMonster(28011,0,2,22,2)
	macro_AddFightMonster(5034,1,4,22,3)
	macro_AddFightMonster(5037,1,2,22,4)
end



