
	macro_AddFightMonster(5034,1,3,6,1)

i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(5011,0,2,10,2)
elseif (i==2) then        
       	macro_AddFightMonster(5034,1,1,8,2)
elseif (i==3) then
	macro_AddFightMonster(5011,0,2,10,2)
	macro_AddFightMonster(5062,1,1,7,3)
end


