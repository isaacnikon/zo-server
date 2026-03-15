	macro_AddFightMonster(5015,1,3,15,1)

i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(28005,0,2,14,2)
elseif (i==2) then        
       	macro_AddFightMonster(5016,1,1,13,2)
elseif (i==3) then
	macro_AddFightMonster(28005,0,2,15,2)
	macro_AddFightMonster(5016,1,1,15,3)
end


