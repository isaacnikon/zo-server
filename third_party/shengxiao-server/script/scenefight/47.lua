

        macro_AddFightMonster(5018,0,1,32,1)
        macro_AddFightMonster(5063,0,3,33,2)


i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(5113,0,2,34,3)
elseif (i==2) then        
       	macro_AddFightMonster(5018,1,1,34,3)
elseif (i==3) then
	macro_AddFightMonster(5113,0,2,34,3)
	macro_AddFightMonster(5047,1,1,32,4)
end



