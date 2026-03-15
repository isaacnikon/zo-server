

        macro_AddFightMonster(5018,0,1,29,1)
        macro_AddFightMonster(5019,0,3,28,2)
	macro_AddFightMonster(5018,1,0,25,3)
	macro_AddFightMonster(5019,1,4,27,4)
        macro_AddFightMonster(5018,1,2,29,5)

i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(5018,0,2,27,6)
elseif (i==2) then        
       	macro_AddFightMonster(5019,1,1,27,6)
elseif (i==3) then
	macro_AddFightMonster(5018,0,2,27,6)
	macro_AddFightMonster(5019,1,1,29,7)
end




