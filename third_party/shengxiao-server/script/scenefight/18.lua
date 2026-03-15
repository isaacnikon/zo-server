	macro_AddFightMonster(5037,1,3,12,1)

i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(28003,0,2,12,2)
elseif (i==2) then        
       	macro_AddFightMonster(5034,1,1,13,2)
elseif (i==3) then
	macro_AddFightMonster(28003,0,2,13,2)
	macro_AddFightMonster(5034,1,1,13,3)
end


