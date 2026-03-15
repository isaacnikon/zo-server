	


	macro_AddFightMonster(5041,1,3,30,1)

i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(28019,0,2,30,2)
	macro_AddFightMonster(5034,1,2,29,3)
elseif (i==2) then        
       	macro_AddFightMonster(5034,1,1,31,2)
	macro_AddFightMonster(5062,1,2,29,3)
elseif (i==3) then
	macro_AddFightMonster(28019,0,2,31,2)
	macro_AddFightMonster(5034,1,2,29,3)
	macro_AddFightMonster(5062,1,1,31,4)
end




